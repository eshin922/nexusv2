import { redirect } from "next/navigation";

// Preserve old bookmarks while opening the global Library modal over the organizer.
export default function LibraryIndex() {
  redirect("/?openLibrary=1");
}
