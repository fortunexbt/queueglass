import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page not-found">
      <p className="truth-badge">Off the board</p>
      <h1>This page is not in the run.</h1>
      <p>There is only one board here, and it starts at tick 0.</p>
      <Link className="button primary" href="/">
        Back to the simulator
      </Link>
    </main>
  );
}
