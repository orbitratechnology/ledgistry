import { requireWorkspace } from "@/server/auth/session";
import { NavUser } from "./nav-user";

export async function SidebarUser() {
  const { user, workspace } = await requireWorkspace();
  return <NavUser email={user.email} workspaceName={workspace.name} />;
}
