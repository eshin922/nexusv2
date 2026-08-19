/**
 * Strip comments before asserting a token is ABSENT from source.
 *
 * Well-documented code explains its own absences, so the prose contains the
 * very word the assertion forbids. That tripped three separate checks in the
 * F1/F4 slice — on `composition`, on `*`/`/`, and on `additionalLines` — each
 * time failing on correct code. A filter that cannot tell a MENTION from a USE
 * measures nothing.
 *
 * It lives here rather than beside the first test that needed it because the
 * cutover needed it too, and a second copy would be a second definition of
 * what counts as "present in the code" — the shape these checks exist to catch.
 *
 * Deliberately NOT a parser. It removes block and whole-line comments, which is
 * what the failure mode requires; a trailing comment on a line of code keeps
 * its code, which is the safe direction — a false MATCH fails loudly, a false
 * absence would pass quietly.
 */
export function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
