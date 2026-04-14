package access

import "testing"

func TestRolesAndPermissions(t *testing.T) {
	if NormalizeRole("", false) != RoleMember {
		t.Fatal("empty role should normalize to member")
	}
	if NormalizeRole(RoleMember, true) != RoleAdmin {
		t.Fatal("legacy admin flag should normalize to admin")
	}
	if !HasPermission(RoleSupport, false, PermissionRecoveryReview) {
		t.Fatal("support should have recovery permission")
	}
	if HasPermission(RoleModerator, false, PermissionAdminPanel) {
		t.Fatal("moderator should not have admin panel access")
	}
}
