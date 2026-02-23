/**
 * pg-client.ts - PostgreSQL Wire Protocol Client
 *
 * WHY THIS EXISTS:
 * Zero-dependency PostgreSQL client using only Node.js built-ins.
 * Implements PostgreSQL wire protocol v3 over TCP (node:net / node:tls).
 *
 * PROTOCOL OVERVIEW:
 * - Startup: [int32 length][int32 version 3.0][key=value\0 pairs\0]
 * - Messages: [byte1 type][int32 length][payload]
 * - Length field includes itself (4 bytes) but NOT the type byte
 *
 * AUTH METHODS:
 * - MD5: md5(md5(password + user) + salt)
 * - SCRAM-SHA-256: RFC 5802 SASL authentication
 *
 * ARCHITECTURE:
 * - PgConnection: single TCP connection with state-machine message parsing
 * - PgPool: connection pool with min/max, idle timeout, waiter queue
 * - query()/execute(): high-level API with parameterized queries
 *
 * PATTERN:
 * State-machine over socket.on('data'), same approach as core/email.js:406-504
 */
import { createConnection, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// ============================================
// TYPES
// ============================================

/** Configuration for a PostgreSQL connection */
export interface PgConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    ssl?: boolean;
    connectTimeoutMs?: number;
    pool?: {
        min?: number;
        max?: number;
        idleTimeoutMs?: number;
        acquireTimeoutMs?: number;
    };
}

/** Pool configuration (resolved from PgConfig.pool with defaults) */
interface PoolConfig {
    min: number;
    max: number;
    idleTimeoutMs: number;
    acquireTimeoutMs: number;
}

/** Result of a query execution */
export interface QueryResult {
    rows: Record<string, unknown>[];
    rowCount: number;
    fields: FieldDescription[];
    command: string;
}

/** Description of a single result column */
export interface FieldDescription {
    name: string;
    tableOid: number;
    columnIndex: number;
    typeOid: number;
    typeLen: number;
    typeMod: number;
    format: number;
}

/** Internal pending query state — tracks the promise callbacks and accumulated rows */
interface PendingQuery {
    resolve: (result: QueryResult) => void;
    reject: (error: Error) => void;
    fields: FieldDescription[];
    rows: Record<string, unknown>[];
    command: string;
}

/** SCRAM authentication state — tracks nonces and keys across multi-step auth */
interface ScramState {
    clientNonce: string;
    clientFirstBare: string;
    serverNonce?: string;
    salt?: Buffer;
    iterations?: number;
    authMessage?: string;
    serverSignature?: Buffer;
}

/** Waiter entry in the pool's acquire queue */
interface PoolWaiter {
    resolve: (conn: PgConnection) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

/** Parsed error response fields from PostgreSQL */
interface PgErrorFields {
    severity: string;
    code: string;
    message: string;
    detail?: string;
}

/** Connection state machine states */
type ConnectionState = 'connecting' | 'authenticating' | 'ready' | 'busy' | 'error' | 'closed';

// ============================================
// BUFFER HELPERS
// ============================================

/**
 * WHY A CUSTOM WRITER:
 * PostgreSQL protocol needs precise binary layout. We build messages
 * by writing type byte + length + payload. A small builder avoids
 * multiple Buffer.alloc/concat calls.
 */
class BufferWriter {
    private buf: Buffer;
    private pos: number;

    constructor(size: number = 256) {
        this.buf = Buffer.alloc(size);
        this.pos = 0;
    }

    ensure(needed: number): void {
        if (this.pos + needed > this.buf.length) {
            const newBuf = Buffer.alloc(Math.max(this.buf.length * 2, this.pos + needed));
            this.buf.copy(newBuf);
            this.buf = newBuf;
        }
    }

    writeByte(val: number): this {
        this.ensure(1);
        this.buf[this.pos++] = val;
        return this;
    }

    writeInt32(val: number): this {
        this.ensure(4);
        this.buf.writeInt32BE(val, this.pos);
        this.pos += 4;
        return this;
    }

    writeInt16(val: number): this {
        this.ensure(2);
        this.buf.writeInt16BE(val, this.pos);
        this.pos += 2;
        return this;
    }

    writeCString(str: string): this {
        const bytes = Buffer.from(str, 'utf-8');
        this.ensure(bytes.length + 1);
        bytes.copy(this.buf, this.pos);
        this.pos += bytes.length;
        this.buf[this.pos++] = 0;
        return this;
    }

    writeBytes(data: Buffer): this {
        this.ensure(data.length);
        data.copy(this.buf, this.pos);
        this.pos += data.length;
        return this;
    }

    flush(): Buffer {
        return this.buf.subarray(0, this.pos);
    }
}

class BufferReader {
    private buf: Buffer;
    private pos: number;

    constructor(buf: Buffer, offset: number = 0) {
        this.buf = buf;
        this.pos = offset;
    }

    readByte(): number {
        return this.buf[this.pos++]!;
    }

    readInt32(): number {
        const val = this.buf.readInt32BE(this.pos);
        this.pos += 4;
        return val;
    }

    readInt16(): number {
        const val = this.buf.readInt16BE(this.pos);
        this.pos += 2;
        return val;
    }

    readCString(): string {
        const end = this.buf.indexOf(0, this.pos);
        const str = this.buf.toString('utf-8', this.pos, end);
        this.pos = end + 1;
        return str;
    }

    readBytes(len: number): Buffer {
        const slice = this.buf.subarray(this.pos, this.pos + len);
        this.pos += len;
        return slice;
    }

    readString(len: number): string {
        const str = this.buf.toString('utf-8', this.pos, this.pos + len);
        this.pos += len;
        return str;
    }

    get remaining(): number {
        return this.buf.length - this.pos;
    }

    get offset(): number {
        return this.pos;
    }
}

// ============================================
// MESSAGE BUILDERS
// ============================================

/**
 * Build startup message (no type byte -- special case in PG protocol)
 * Format: [int32 length][int32 version 196608 (3.0)][key\0value\0 pairs]\0
 */
function buildStartupMessage(user: string, database: string): Buffer {
    const w = new BufferWriter();
    w.writeInt32(0); // placeholder for length
    w.writeInt32(196608); // protocol version 3.0
    w.writeCString('user');
    w.writeCString(user);
    w.writeCString('database');
    w.writeCString(database);
    w.writeCString('client_encoding');
    w.writeCString('UTF8');
    w.writeByte(0); // terminator
    const buf = w.flush();
    buf.writeInt32BE(buf.length, 0); // fill in length
    return buf;
}

/**
 * Build a typed message: [byte1 type][int32 length][payload]
 */
function buildMessage(type: number, payload: Buffer): Buffer {
    const buf = Buffer.alloc(1 + 4 + payload.length);
    buf[0] = type;
    buf.writeInt32BE(4 + payload.length, 1);
    payload.copy(buf, 5);
    return buf;
}

/** Simple query: Q message */
function buildSimpleQuery(sql: string): Buffer {
    const w = new BufferWriter();
    w.writeCString(sql);
    return buildMessage(0x51, w.flush()); // 'Q'
}

/** Parse message for extended protocol */
function buildParse(name: string, sql: string, paramTypes: number[] = []): Buffer {
    const w = new BufferWriter();
    w.writeCString(name);
    w.writeCString(sql);
    w.writeInt16(paramTypes.length);
    for (const oid of paramTypes) {
        w.writeInt32(oid);
    }
    return buildMessage(0x50, w.flush()); // 'P'
}

/** Bind message for extended protocol */
function buildBind(portal: string, statement: string, params: (string | null)[]): Buffer {
    const w = new BufferWriter();
    w.writeCString(portal);
    w.writeCString(statement);
    // Format codes: 0 = text for all
    w.writeInt16(0);
    // Parameter values
    w.writeInt16(params.length);
    for (const p of params) {
        if (p === null) {
            w.writeInt32(-1); // NULL
        }
        else {
            const bytes = Buffer.from(p, 'utf-8');
            w.writeInt32(bytes.length);
            w.writeBytes(bytes);
        }
    }
    // Result format codes: 0 = text for all
    w.writeInt16(0);
    return buildMessage(0x42, w.flush()); // 'B'
}

/** Describe message */
function buildDescribe(type: string, name: string): Buffer {
    const w = new BufferWriter();
    w.writeByte(type.charCodeAt(0));
    w.writeCString(name);
    return buildMessage(0x44, w.flush()); // 'D'
}

/** Execute message */
function buildExecute(portal: string, maxRows: number = 0): Buffer {
    const w = new BufferWriter();
    w.writeCString(portal);
    w.writeInt32(maxRows);
    return buildMessage(0x45, w.flush()); // 'E'
}

/** Sync message -- signals end of extended protocol pipeline */
function buildSync(): Buffer {
    return buildMessage(0x53, Buffer.alloc(0)); // 'S'
}

/** Terminate message */
function buildTerminate(): Buffer {
    return buildMessage(0x58, Buffer.alloc(0)); // 'X'
}

/** MD5 password response */
function buildMD5PasswordMessage(user: string, password: string, salt: Buffer): Buffer {
    // md5(md5(password + user) + salt)
    const inner = createHash('md5').update(password + user).digest('hex');
    const outer = 'md5' + createHash('md5').update(inner + salt.toString('binary')).digest('hex');
    const w = new BufferWriter();
    w.writeCString(outer);
    return buildMessage(0x70, w.flush()); // 'p'
}

function scramClientFirstMessage(user: string): { message: Buffer; state: ScramState } {
    const clientNonce = randomBytes(18).toString('base64');
    const clientFirstBare = `n=${user},r=${clientNonce}`;
    const gs2Header = 'n,,';
    const clientFirst = gs2Header + clientFirstBare;
    // SASL initial response: mechanism name + initial data
    const w = new BufferWriter();
    w.writeCString('SCRAM-SHA-256');
    const data = Buffer.from(clientFirst, 'utf-8');
    w.writeInt32(data.length);
    w.writeBytes(data);
    const message = buildMessage(0x70, w.flush()); // 'p' (password/SASL)
    return { message, state: { clientNonce, clientFirstBare } };
}

function scramClientFinalMessage(
    password: string,
    serverFirstData: Buffer,
    state: ScramState
): { message: Buffer; state: ScramState } {
    const serverFirst = serverFirstData.toString('utf-8');
    // Parse server-first-message: r=<nonce>,s=<salt>,i=<iterations>
    const parts: Record<string, string> = {};
    for (const part of serverFirst.split(',')) {
        const key = part[0];
        const val = part.substring(2);
        if (key) {
            parts[key] = val;
        }
    }
    const serverNonce = parts['r'] ?? '';
    const salt = Buffer.from(parts['s'] ?? '', 'base64');
    const iterations = parseInt(parts['i'] ?? '4096', 10);
    // Verify server nonce starts with our client nonce
    if (!serverNonce.startsWith(state.clientNonce)) {
        throw new Error('SCRAM: server nonce does not start with client nonce');
    }
    // SaltedPassword = Hi(password, salt, iterations) -- PBKDF2
    const saltedPassword = pbkdf2Sync(password, salt, iterations);
    const clientKey = hmac256(saltedPassword, 'Client Key');
    const storedKey = createHash('sha256').update(clientKey).digest();
    const clientFinalWithoutProof = `c=${Buffer.from('n,,').toString('base64')},r=${serverNonce}`;
    const authMessage = `${state.clientFirstBare},${serverFirst},${clientFinalWithoutProof}`;
    const clientSignature = hmac256(storedKey, authMessage);
    // ClientProof = ClientKey XOR ClientSignature
    const clientProof = Buffer.alloc(clientKey.length);
    for (let i = 0; i < clientKey.length; i++) {
        clientProof[i] = clientKey[i]! ^ clientSignature[i]!;
    }
    const serverKey = hmac256(saltedPassword, 'Server Key');
    const serverSignature = hmac256(serverKey, authMessage);
    const clientFinal = `${clientFinalWithoutProof},p=${clientProof.toString('base64')}`;
    const w = new BufferWriter();
    w.writeBytes(Buffer.from(clientFinal, 'utf-8'));
    const message = buildMessage(0x70, w.flush());
    return {
        message,
        state: {
            ...state,
            serverNonce,
            salt,
            iterations,
            authMessage,
            serverSignature,
        },
    };
}

function scramVerifyServerFinal(serverFinalData: Buffer, state: ScramState): void {
    const serverFinal = serverFinalData.toString('utf-8');
    // Parse v=<server-signature>
    if (!serverFinal.startsWith('v=')) {
        throw new Error('SCRAM: invalid server final message');
    }
    const receivedSig = Buffer.from(serverFinal.substring(2), 'base64');
    if (!state.serverSignature || !timingSafeEqual(receivedSig, state.serverSignature)) {
        throw new Error('SCRAM: server signature mismatch');
    }
}

/** PBKDF2 with SHA-256 -- implements Hi() from RFC 5802 */
function pbkdf2Sync(password: string, salt: Buffer, iterations: number): Buffer {
    let ui = hmac256(password, Buffer.concat([salt, Buffer.from([0, 0, 0, 1])]));
    const result = Buffer.from(ui);
    for (let i = 1; i < iterations; i++) {
        ui = hmac256(password, ui);
        for (let j = 0; j < result.length; j++) {
            result[j]! ^= ui[j]!;
        }
    }
    return result;
}

function hmac256(key: string | Buffer, data: string | Buffer): Buffer {
    return createHmac('sha256', key).update(data).digest();
}

// ============================================
// PgConnection
// ============================================

export class PgConnection {
    private socket: Socket | TLSSocket | null = null;
    private state: ConnectionState = 'connecting';
    private config: PgConfig;
    // Incoming data buffer -- messages may span multiple data events
    private incomingBuffer: Buffer = Buffer.alloc(0);
    // Auth state
    private scramState: ScramState | null = null;
    // Startup promise
    private connectResolve: (() => void) | null = null;
    private connectReject: ((err: unknown) => void) | null = null;
    // Active query
    private pending: PendingQuery | null = null;
    // Server info
    parameters: Record<string, string> = {};
    processId: number = 0;
    secretKey: number = 0;
    private transactionStatus: string = 'I'; // I=idle, T=in transaction, E=failed
    // Pool management
    lastUsed: number = Date.now();
    inUse: boolean = false;

    constructor(config: PgConfig) {
        this.config = config;
    }

    /**
     * Open TCP connection and complete authentication handshake.
     * Resolves when ReadyForQuery is received.
     */
    async connect(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.connectResolve = resolve;
            this.connectReject = reject;
            const { host, port, ssl, connectTimeoutMs = 5000 } = this.config;
            const onConnect = (): void => {
                // Send startup message
                this.socket!.write(buildStartupMessage(this.config.user, this.config.database));
                this.state = 'authenticating';
            };
            if (ssl) {
                this.socket = tlsConnect({ host, port, rejectUnauthorized: false }, onConnect);
            }
            else {
                this.socket = createConnection({ host, port }, onConnect);
            }
            this.socket.setTimeout(connectTimeoutMs);
            this.socket.on('data', (data: Buffer) => this.onData(data));
            this.socket.on('error', (err: Error) => this.onError(err));
            this.socket.on('close', () => this.onClose());
            this.socket.on('timeout', () => {
                this.onError(new Error(`Connection timeout after ${connectTimeoutMs}ms`));
                this.socket?.destroy();
            });
        });
    }

    /**
     * Process incoming data -- accumulate in buffer, parse complete messages
     */
    private onData(data: Buffer): void {
        this.incomingBuffer = Buffer.concat([this.incomingBuffer, data]);
        this.processMessages();
    }

    /**
     * Parse and dispatch complete protocol messages from the buffer.
     *
     * WHY A LOOP:
     * A single TCP data event may contain multiple PG messages, or a
     * partial message. We keep parsing until we can't extract a full
     * message, leaving any remainder for the next data event.
     */
    private processMessages(): void {
        while (this.incomingBuffer.length >= 5) {
            const type = this.incomingBuffer[0]!;
            const length = this.incomingBuffer.readInt32BE(1);
            const totalLength = 1 + length; // type byte + length (includes itself)
            if (this.incomingBuffer.length < totalLength) {
                break; // Incomplete message -- wait for more data
            }
            const payload = this.incomingBuffer.subarray(5, totalLength);
            this.incomingBuffer = this.incomingBuffer.subarray(totalLength);
            this.handleMessage(type, payload);
        }
    }

    /**
     * Route a parsed message to its handler based on type byte.
     * This is the core state machine -- equivalent to the switch(step) in email.js.
     */
    private handleMessage(type: number, payload: Buffer): void {
        switch (type) {
            case 82 /* BackendMessage.Authentication */:
                this.handleAuth(payload);
                break;
            case 83 /* BackendMessage.ParameterStatus */: {
                const r = new BufferReader(payload);
                const key = r.readCString();
                const value = r.readCString();
                this.parameters[key] = value;
                break;
            }
            case 75 /* BackendMessage.BackendKeyData */: {
                const r = new BufferReader(payload);
                this.processId = r.readInt32();
                this.secretKey = r.readInt32();
                break;
            }
            case 90 /* BackendMessage.ReadyForQuery */: {
                this.transactionStatus = String.fromCharCode(payload[0]!);
                if (this.state === 'authenticating') {
                    // Startup complete
                    this.state = 'ready';
                    this.socket?.setTimeout(0); // Clear connect timeout
                    this.connectResolve?.();
                    this.connectResolve = null;
                    this.connectReject = null;
                }
                else if (this.state === 'busy' && this.pending) {
                    // Query complete
                    const p = this.pending;
                    this.pending = null;
                    this.state = 'ready';
                    p.resolve({
                        rows: p.rows,
                        rowCount: p.rows.length,
                        fields: p.fields,
                        command: p.command,
                    });
                }
                break;
            }
            case 84 /* BackendMessage.RowDescription */: {
                if (this.pending) {
                    const r = new BufferReader(payload);
                    const fieldCount = r.readInt16();
                    const fields: FieldDescription[] = [];
                    for (let i = 0; i < fieldCount; i++) {
                        fields.push({
                            name: r.readCString(),
                            tableOid: r.readInt32(),
                            columnIndex: r.readInt16(),
                            typeOid: r.readInt32(),
                            typeLen: r.readInt16(),
                            typeMod: r.readInt32(),
                            format: r.readInt16(),
                        });
                    }
                    this.pending.fields = fields;
                }
                break;
            }
            case 68 /* BackendMessage.DataRow */: {
                if (this.pending) {
                    const r = new BufferReader(payload);
                    const colCount = r.readInt16();
                    const row: Record<string, unknown> = {};
                    for (let i = 0; i < colCount; i++) {
                        const len = r.readInt32();
                        const field = this.pending.fields[i];
                        if (len === -1) {
                            row[field?.name ?? `col${i}`] = null;
                        }
                        else {
                            const val = r.readString(len);
                            row[field?.name ?? `col${i}`] = parseValue(val, field?.typeOid ?? 0);
                        }
                    }
                    this.pending.rows.push(row);
                }
                break;
            }
            case 67 /* BackendMessage.CommandComplete */: {
                if (this.pending) {
                    const r = new BufferReader(payload);
                    this.pending.command = r.readCString();
                }
                break;
            }
            case 69 /* BackendMessage.ErrorResponse */: {
                const error = parseErrorResponse(payload);
                if (this.state === 'authenticating') {
                    this.state = 'error';
                    this.connectReject?.(new Error(`PG auth error: ${error.message}`));
                    this.connectResolve = null;
                    this.connectReject = null;
                }
                else if (this.pending) {
                    const p = this.pending;
                    this.pending = null;
                    // State stays 'busy' until ReadyForQuery
                    p.reject(new Error(`PG query error: ${error.message}`));
                }
                break;
            }
            case 78 /* BackendMessage.NoticeResponse */:
                // Informational -- ignore
                break;
            case 49 /* BackendMessage.ParseComplete */:
            case 50 /* BackendMessage.BindComplete */:
            case 51 /* BackendMessage.CloseComplete */:
            case 110 /* BackendMessage.NoData */:
            case 73 /* BackendMessage.EmptyQueryResponse */:
                // Extended protocol acknowledgements -- no action needed
                break;
            default:
                // Unknown message type -- ignore
                break;
        }
    }

    /**
     * Handle authentication sub-messages.
     * Auth type is in the first 4 bytes of payload.
     */
    private handleAuth(payload: Buffer): void {
        const r = new BufferReader(payload);
        const authType = r.readInt32();
        switch (authType) {
            case 0 /* AuthType.Ok */:
                // Auth successful -- wait for ReadyForQuery
                break;
            case 5 /* AuthType.MD5Password */: {
                const salt = r.readBytes(4);
                this.socket!.write(buildMD5PasswordMessage(this.config.user, this.config.password, salt));
                break;
            }
            case 10 /* AuthType.SASL */: {
                // Server sends list of mechanisms
                // We only support SCRAM-SHA-256
                const { message, state } = scramClientFirstMessage(this.config.user);
                this.scramState = state;
                this.socket!.write(message);
                break;
            }
            case 11 /* AuthType.SASLContinue */: {
                if (!this.scramState) {
                    this.connectReject?.(new Error('SCRAM: unexpected SASLContinue'));
                    return;
                }
                const serverData = r.readBytes(r.remaining);
                const { message, state } = scramClientFinalMessage(this.config.password, serverData, this.scramState);
                this.scramState = state;
                this.socket!.write(message);
                break;
            }
            case 12 /* AuthType.SASLFinal */: {
                if (!this.scramState) {
                    this.connectReject?.(new Error('SCRAM: unexpected SASLFinal'));
                    return;
                }
                const serverFinalData = r.readBytes(r.remaining);
                try {
                    scramVerifyServerFinal(serverFinalData, this.scramState);
                }
                catch (err: unknown) {
                    this.connectReject?.(err);
                }
                this.scramState = null;
                // Now wait for AuthenticationOk + ReadyForQuery
                break;
            }
            default:
                this.connectReject?.(new Error(`Unsupported auth type: ${authType}`));
                break;
        }
    }

    private onError(err: Error): void {
        if (this.state === 'connecting' || this.state === 'authenticating') {
            this.state = 'error';
            this.connectReject?.(err);
            this.connectResolve = null;
            this.connectReject = null;
        }
        if (this.pending) {
            const p = this.pending;
            this.pending = null;
            p.reject(err);
        }
        this.state = 'error';
    }

    private onClose(): void {
        this.state = 'closed';
        if (this.pending) {
            const p = this.pending;
            this.pending = null;
            p.reject(new Error('Connection closed unexpectedly'));
        }
    }

    // ============================================
    // PUBLIC API
    // ============================================

    /**
     * Execute a simple query (no parameters).
     * Uses the Simple Query protocol -- single Q message.
     */
    async simpleQuery(sql: string): Promise<QueryResult> {
        if (this.state !== 'ready') {
            throw new Error(`Cannot query: connection state is '${this.state}'`);
        }
        return new Promise<QueryResult>((resolve, reject) => {
            this.state = 'busy';
            this.pending = { resolve, reject, fields: [], rows: [], command: '' };
            this.socket!.write(buildSimpleQuery(sql));
        });
    }

    /**
     * Execute a parameterized query using the Extended Protocol.
     * Parse -> Bind -> Describe -> Execute -> Sync
     *
     * WHY EXTENDED PROTOCOL:
     * Prevents SQL injection by sending parameters separately from the query.
     * PostgreSQL handles escaping and type coercion server-side.
     */
    async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
        if (this.state !== 'ready') {
            throw new Error(`Cannot query: connection state is '${this.state}'`);
        }
        // Convert params to string|null for text format
        const textParams: (string | null)[] = params.map(p =>
            p === null || p === undefined ? null : String(p)
        );
        return new Promise<QueryResult>((resolve, reject) => {
            this.state = 'busy';
            this.pending = { resolve, reject, fields: [], rows: [], command: '' };
            // Send Parse-Bind-Describe-Execute-Sync pipeline in one write
            const messages = Buffer.concat([
                buildParse('', sql),
                buildBind('', '', textParams),
                buildDescribe('P', ''),
                buildExecute(''),
                buildSync(),
            ]);
            this.socket!.write(messages);
        });
    }

    /** Send TERMINATE and close the socket */
    async close(): Promise<void> {
        if (this.socket && this.state !== 'closed') {
            this.socket.write(buildTerminate());
            this.socket.end();
            this.state = 'closed';
        }
    }

    get isReady(): boolean {
        return this.state === 'ready';
    }

    get isClosed(): boolean {
        return this.state === 'closed' || this.state === 'error';
    }

    get txStatus(): string {
        return this.transactionStatus;
    }
}

// ============================================
// TYPE PARSING
// ============================================

/**
 * Parse a text-format value from PostgreSQL to a JS type.
 *
 * WHY TEXT FORMAT:
 * We use text format for all values (format code 0). This is simpler
 * and PostgreSQL sends all common types as readable strings. Binary
 * format would be faster but adds significant parsing complexity.
 */
function parseValue(val: string, typeOid: number): unknown {
    switch (typeOid) {
        case 20: // int8
        case 21: // int2
        case 23: // int4
        case 26: // oid
            return parseInt(val, 10);
        case 700: // float4
        case 701: // float8
        case 1700: // numeric
            return parseFloat(val);
        case 16: // bool
            return val === 't' || val === 'true';
        case 114: // json
        case 3802: // jsonb
            try {
                return JSON.parse(val) as unknown;
            }
            catch {
                return val;
            }
        case 1082: // date
        case 1114: // timestamp
        case 1184: // timestamptz
            return new Date(val);
        default:
            return val; // Return as string
    }
}

/** Parse ErrorResponse/NoticeResponse fields */
function parseErrorResponse(payload: Buffer): PgErrorFields {
    const r = new BufferReader(payload);
    const fields: Record<string, string> = {};
    while (r.remaining > 0) {
        const fieldType = r.readByte();
        if (fieldType === 0) break;
        fields[String.fromCharCode(fieldType)] = r.readCString();
    }
    return {
        severity: fields['S'] ?? 'ERROR',
        code: fields['C'] ?? 'XXXXX',
        message: fields['M'] ?? 'Unknown error',
        detail: fields['D'],
    };
}

// ============================================
// PgPool
// ============================================

export class PgPool {
    private config: PgConfig;
    private poolConfig: PoolConfig;
    private connections: PgConnection[] = [];
    private waiters: PoolWaiter[] = [];
    private idleTimer: ReturnType<typeof setInterval> | null = null;
    private closed: boolean = false;

    constructor(config: PgConfig, poolConfig: PoolConfig) {
        this.config = config;
        this.poolConfig = poolConfig;
    }

    /**
     * Initialize pool with minimum connections and start idle reaper.
     */
    async initialize(): Promise<void> {
        // Create minimum connections
        const promises: Promise<void>[] = [];
        for (let i = 0; i < this.poolConfig.min; i++) {
            promises.push(this.createConnection());
        }
        await Promise.all(promises);
        // Start idle connection reaper
        this.idleTimer = setInterval(() => this.reapIdle(), this.poolConfig.idleTimeoutMs);
        // Unref so it doesn't prevent process exit
        if (this.idleTimer.unref) {
            this.idleTimer.unref();
        }
    }

    private async createConnection(): Promise<void> {
        const conn = new PgConnection(this.config);
        await conn.connect();
        this.connections.push(conn);
    }

    /**
     * Acquire a connection from the pool.
     * Returns an idle connection if available, creates a new one if under max,
     * or waits in queue until one becomes available.
     */
    async acquire(): Promise<PgConnection> {
        if (this.closed) {
            throw new Error('Pool is closed');
        }
        // Try to find an idle connection
        const idle = this.connections.find(c => !c.inUse && c.isReady);
        if (idle) {
            idle.inUse = true;
            idle.lastUsed = Date.now();
            return idle;
        }
        // Create new connection if under max
        if (this.connections.length < this.poolConfig.max) {
            const conn = new PgConnection(this.config);
            await conn.connect();
            conn.inUse = true;
            conn.lastUsed = Date.now();
            this.connections.push(conn);
            return conn;
        }
        // Wait for a connection to become available
        return new Promise<PgConnection>((resolve, reject) => {
            const timer = setTimeout(() => {
                const idx = this.waiters.findIndex(w => w.resolve === resolve);
                if (idx !== -1) this.waiters.splice(idx, 1);
                reject(new Error(`Acquire timeout after ${this.poolConfig.acquireTimeoutMs}ms`));
            }, this.poolConfig.acquireTimeoutMs);
            this.waiters.push({ resolve, reject, timer });
        });
    }

    /**
     * Release a connection back to the pool.
     * If waiters are queued, hand the connection to the first waiter.
     */
    release(conn: PgConnection): void {
        conn.inUse = false;
        conn.lastUsed = Date.now();
        // If there's a waiter, give them this connection
        if (this.waiters.length > 0) {
            const waiter = this.waiters.shift()!;
            clearTimeout(waiter.timer);
            conn.inUse = true;
            waiter.resolve(conn);
        }
    }

    /** Remove dead connections and trim idle ones above min */
    private reapIdle(): void {
        const now = Date.now();
        const timeout = this.poolConfig.idleTimeoutMs;
        this.connections = this.connections.filter(conn => {
            if (conn.isClosed) {
                return false; // Remove dead connections
            }
            if (!conn.inUse &&
                now - conn.lastUsed > timeout &&
                this.connections.length > this.poolConfig.min) {
                void conn.close(); // Close idle connection above min
                return false;
            }
            return true;
        });
    }

    // ============================================
    // HIGH-LEVEL API
    // ============================================

    /**
     * Execute a parameterized query, automatically acquiring and releasing a connection.
     */
    async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
        const conn = await this.acquire();
        try {
            const result = await conn.query(sql, params);
            return result;
        }
        finally {
            this.release(conn);
        }
    }

    /**
     * Execute a simple (non-parameterized) query.
     */
    async simpleQuery(sql: string): Promise<QueryResult> {
        const conn = await this.acquire();
        try {
            const result = await conn.simpleQuery(sql);
            return result;
        }
        finally {
            this.release(conn);
        }
    }

    /**
     * Run a function within a database transaction.
     *
     * WHY A CALLBACK PATTERN:
     * Ensures BEGIN/COMMIT/ROLLBACK are always paired correctly.
     * The connection stays acquired for the entire transaction duration --
     * PostgreSQL transactions are per-connection.
     */
    async transaction<T>(fn: (conn: PgConnection) => Promise<T>): Promise<T> {
        const conn = await this.acquire();
        try {
            await conn.simpleQuery('BEGIN');
            const result = await fn(conn);
            await conn.simpleQuery('COMMIT');
            return result;
        }
        catch (err: unknown) {
            try {
                await conn.simpleQuery('ROLLBACK');
            }
            catch {
                // Rollback failed -- connection is likely dead
                // Pool reaper will clean it up
            }
            throw err;
        }
        finally {
            this.release(conn);
        }
    }

    /**
     * Close all connections and stop the idle reaper.
     */
    async close(): Promise<void> {
        this.closed = true;
        if (this.idleTimer) {
            clearInterval(this.idleTimer);
            this.idleTimer = null;
        }
        // Reject all waiters
        for (const waiter of this.waiters) {
            clearTimeout(waiter.timer);
            waiter.reject(new Error('Pool is closing'));
        }
        this.waiters = [];
        // Close all connections
        await Promise.all(this.connections.map(c => c.close()));
        this.connections = [];
    }

    /** Number of total connections in the pool */
    get size(): number {
        return this.connections.length;
    }

    /** Number of idle (available) connections */
    get idle(): number {
        return this.connections.filter(c => !c.inUse && c.isReady).length;
    }

    /** Number of active (in-use) connections */
    get active(): number {
        return this.connections.filter(c => c.inUse).length;
    }

    /** Number of callers waiting for a connection */
    get waiting(): number {
        return this.waiters.length;
    }
}

// ============================================
// FACTORY
// ============================================

/**
 * Create and initialize a connection pool from config files.
 * This is the main entry point used by the boot sequence.
 */
export async function createPool(dbConfig: PgConfig): Promise<PgPool> {
    const poolConfig: PoolConfig = {
        min: dbConfig.pool?.min ?? 2,
        max: dbConfig.pool?.max ?? 10,
        idleTimeoutMs: dbConfig.pool?.idleTimeoutMs ?? 30000,
        acquireTimeoutMs: dbConfig.pool?.acquireTimeoutMs ?? 5000,
    };
    const pool = new PgPool(dbConfig, poolConfig);
    await pool.initialize();
    return pool;
}
