import "server-only";
import type {
  AuthenticationDependencies,
  ApplicationIdentity,
} from "@/lib/auth/identity-provider";

const IDENTITIES = {
  pm: {
    externalUserId: "validation_clerk_pm",
    email: "pm@nexus-validation.invalid",
    firstName: "Validation",
    lastName: "PM",
  },
  admin: {
    externalUserId: "validation_clerk_admin",
    email: "admin@nexus-validation.invalid",
    firstName: "Validation",
    lastName: "Admin",
  },
} as const satisfies Record<string, ApplicationIdentity>;

function selectedIdentity(): ApplicationIdentity | null {
  const selected = process.env.NEXUS_VALIDATION_IDENTITY ?? "pm";
  if (selected === "unauthorized") return null;
  if (selected !== "pm" && selected !== "admin") {
    throw new Error(
      "[validation-auth] identity must be pm, admin, or unauthorized",
    );
  }
  return IDENTITIES[selected];
}

export const validationAuthentication: AuthenticationDependencies = {
  identity: {
    name: "validation-identity",
    kind: "isolated",
    async current() {
      return selectedIdentity();
    },
  },
  ui: {
    wrapApplication(children) {
      return children;
    },
    renderSignIn() {
      return (
        <main className="mx-auto max-w-lg p-8">
          <h1 className="font-display text-2xl">
            Validation identity unavailable
          </h1>
          <p className="mt-3 text-sm text-ink-3">
            Restart the isolated process with an authorized process-start
            identity to test protected workflows.
          </p>
        </main>
      );
    },
    renderSignOutControl({ children }) {
      return children;
    },
  },
};
