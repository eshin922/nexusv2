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
    current: currentIdentity,
  },
  ui: {
    wrapApplication(children) {
      // The Nexus splash is the entrance; Clerk's hosted Account Portal is not.
      //
      // Both props are needed, and NOT because both typecheck — they govern
      // different things:
      //
      //   signInUrl        where Clerk sends a client that needs to sign in.
      //                    Its instance default is the hosted Account Portal.
      //   afterSignOutUrl  the GLOBAL sign-out destination, for any sign-out
      //                    that does not name one of its own.
      //
      // `afterSignOutUrl` does not govern the button below. See
      // `renderSignOutControl` for why that is a runtime fact rather than a
      // preference.
      return (
        <ClerkProvider signInUrl="/sign-in" afterSignOutUrl="/sign-in">
          {children}
        </ClerkProvider>
      );
    },
    renderSignIn() {
      return <SignIn />;
    },
    renderSignOutControl({ children }) {
      // `redirectUrl` is REQUIRED here, and the installed runtime is why.
      //
      // @clerk/clerk-react destructures `const { redirectUrl = "/" } = props`
      // and always forwards it to `clerk.signOut({ redirectUrl })`. So the
      // button does not defer to the provider's `afterSignOutUrl` — it SHADOWS
      // it with its own default of "/". Setting the provider alone would leave
      // sign-out landing on "/", which middleware then bounces to the splash:
      // correct by accident, one hop longer, and dependent on a redirect to
      // repair a destination we could simply state.
      return <SignOutButton redirectUrl="/sign-in">{children}</SignOutButton>;
    },
  },
};
