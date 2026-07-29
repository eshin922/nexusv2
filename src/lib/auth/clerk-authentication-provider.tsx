import "server-only";
import { ClerkProvider, SignIn, SignOutButton } from "@clerk/nextjs";
import { auth, currentUser } from "@clerk/nextjs/server";
import type {
  AuthenticationDependencies,
  ApplicationIdentity,
} from "@/lib/auth/identity-provider";

async function currentIdentity(): Promise<ApplicationIdentity | null> {
  const [{ userId }, user] = await Promise.all([auth(), currentUser()]);
  if (!userId || !user) return null;
  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress;
  if (!email) return null;
  return {
    externalUserId: userId,
    email,
    firstName: user.firstName,
    lastName: user.lastName,
  };
}

export const clerkAuthentication: AuthenticationDependencies = {
  identity: {
    name: "clerk",
    kind: "production",
    provisionMissingUsers: true,
    current: currentIdentity,
  },
  ui: {
    wrapApplication(children) {
      return <ClerkProvider>{children}</ClerkProvider>;
    },
    renderSignIn() {
      return <SignIn />;
    },
    renderSignOutControl({ children }) {
      return <SignOutButton>{children}</SignOutButton>;
    },
  },
};
