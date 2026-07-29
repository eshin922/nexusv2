import { getApplicationDependencies } from "@/lib/integrations/composition";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string }>;
}) {
  const sp = await searchParams;
  const unauthorized = sp.error === "unauthorized";
  const { authentication } = await getApplicationDependencies();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      {unauthorized && (
        <div
          role="alert"
          className="max-w-md rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        >
          <p className="font-semibold">
            Your email is not authorized to access this application.
          </p>
          <p className="mt-1">
            {sp.email ? (
              <>
                The account{" "}
                <span className="font-mono">{sp.email}</span> was rejected.{" "}
              </>
            ) : null}
            Contact your administrator if you believe this is an error.
          </p>
        </div>
      )}
      {authentication.ui.renderSignIn()}
    </main>
  );
}
