import { getApplicationDependencies } from "@/lib/integrations/composition";

export async function ApplicationAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { authentication } = await getApplicationDependencies();
  return authentication.ui.wrapApplication(children);
}
