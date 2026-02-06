---
title: Users and Roles
module: admin
route: /admin/users
related: permissions, workflow, content-management
keywords: users, roles, permissions, access, security
---

## Users and Roles

Manage who has access to your site and what they can do.

### User Roles

Roles define what users can do on your site:

- **Admin** - Full access to everything
- **Editor** - Manage all content and users
- **Author** - Create and publish own content
- **Contributor** - Create drafts, cannot publish
- **Viewer** - Read-only access

### Adding Users

1. Go to **Admin > Users**
2. Click **Add User**
3. Fill in user information:
   - Username
   - Email
   - Password
   - Role
4. Click **Save**

The user will receive a welcome email with login instructions.

### Managing Permissions

Each role has specific permissions:

**Admin:**
- All permissions

**Editor:**
- Create, edit, delete any content
- Manage users (except admins)
- Configure site settings

**Author:**
- Create content
- Edit own content
- Publish own content

**Contributor:**
- Create content
- Edit own content
- Cannot publish

**Viewer:**
- View content
- No editing capabilities

### Custom Roles

Create custom roles for specific needs:
1. Go to **Config > Roles**
2. Click **Create Role**
3. Name your role
4. Select permissions
5. Save

### User Management

Manage existing users:
- **Edit** - Change user details or role
- **Disable** - Temporarily block access
- **Delete** - Permanently remove user
- **Reset Password** - Send password reset email

### Security Best Practices

- Use strong passwords
- Limit admin access to trusted users
- Regularly review user accounts
- Remove inactive users
- Enable two-factor authentication
- Use role-based access control

### Bulk User Operations

Manage multiple users at once:
- Change roles for selected users
- Disable/enable multiple accounts
- Send bulk email notifications
- Export user data

### Tips

- Assign the minimum role needed for each user
- Create custom roles for specific workflows
- Review permissions regularly
- Use email notifications for account changes
- Document role assignments for your team
