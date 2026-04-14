package access

import "sort"

const (
	RoleMember    = "member"
	RoleModerator = "moderator"
	RoleSupport   = "support"
	RoleAdmin     = "admin"
)

const (
	PermissionAdminPanel     = "admin.panel"
	PermissionRecoveryReview = "recovery.review"
	PermissionUsersModerate  = "users.moderate"
	PermissionSupportTools   = "support.tools"
	PermissionRealtimeStream = "realtime.stream"
)

var rolePermissions = map[string]map[string]struct{}{
	RoleMember: {
		PermissionRealtimeStream: {},
	},
	RoleModerator: {
		PermissionRealtimeStream: {},
		PermissionUsersModerate:  {},
	},
	RoleSupport: {
		PermissionRealtimeStream: {},
		PermissionSupportTools:   {},
		PermissionRecoveryReview: {},
	},
	RoleAdmin: {
		PermissionRealtimeStream: {},
		PermissionSupportTools:   {},
		PermissionRecoveryReview: {},
		PermissionUsersModerate:  {},
		PermissionAdminPanel:     {},
	},
}

func NormalizeRole(role string, isAdmin bool) string {
	if isAdmin {
		return RoleAdmin
	}
	switch role {
	case RoleAdmin, RoleSupport, RoleModerator, RoleMember:
		return role
	default:
		return RoleMember
	}
}

func PermissionsForRole(role string, isAdmin bool) []string {
	permissionsMap, ok := rolePermissions[NormalizeRole(role, isAdmin)]
	if !ok {
		permissionsMap = rolePermissions[RoleMember]
	}
	permissions := make([]string, 0, len(permissionsMap))
	for permission := range permissionsMap {
		permissions = append(permissions, permission)
	}
	sort.Strings(permissions)
	return permissions
}

func HasPermission(role string, isAdmin bool, permission string) bool {
	permissionsMap, ok := rolePermissions[NormalizeRole(role, isAdmin)]
	if !ok {
		return false
	}
	_, allowed := permissionsMap[permission]
	return allowed
}

func CanAccessAdminPanel(role string, isAdmin bool) bool {
	return HasPermission(role, isAdmin, PermissionAdminPanel)
}
