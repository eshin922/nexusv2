import { currentUser } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";

export default async function Home() {
  const user = await currentUser();
  const name = user?.firstName ?? user?.emailAddresses[0]?.emailAddress ?? "there";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-semibold">Hello, {name}.</h1>
      <p className="text-sm text-gray-500">DPS Quoting Tool — Slice 1 (Foundation)</p>
      <SignOutButton>
        <button className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700">
          Sign out
        </button>
      </SignOutButton>
    </main>
  );
}
