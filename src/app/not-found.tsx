import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page not-found">
      <p className="truth-badge">Not found</p>
      <h1>This page is not in the line.</h1>
      <p>There is only one page here: the one where you enter your steps and arrivals.</p>
      <Link className="button primary" href="/">
        Back to queueglass
      </Link>
    </main>
  );
}
