export type IntegrationProviderKind = "production" | "isolated";

export interface IntegrationProviderDescriptor {
  readonly name: string;
  readonly kind: IntegrationProviderKind;
}

export function assertIsolatedProviderSet(
  providers: readonly IntegrationProviderDescriptor[],
): void {
  const unsafe = providers.filter((provider) => provider.kind !== "isolated");
  if (unsafe.length > 0) {
    throw new Error(
      `[provider-kind] isolated runtime received non-isolated providers: ${unsafe
        .map((provider) => provider.name)
        .join(", ")}`,
    );
  }
}

