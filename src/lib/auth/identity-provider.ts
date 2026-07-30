import type { ReactNode } from "react";

export type ApplicationIdentity = {
  externalUserId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

export interface IdentityProvider {
  readonly name: string;
  readonly kind: "production" | "isolated";
  readonly provisionMissingUsers: boolean;
  current(): Promise<ApplicationIdentity | null>;
}

export interface AuthUiProvider {
  wrapApplication(children: ReactNode): ReactNode;
  renderSignIn(): ReactNode;
  renderSignOutControl(input: {
    children: ReactNode;
    email: string;
  }): ReactNode;
}

export type AuthenticationDependencies = {
  identity: IdentityProvider;
  ui: AuthUiProvider;
};
