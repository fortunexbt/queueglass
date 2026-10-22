import styles from "./FlapText.module.css";

// Each character sits on its own tile. A changed character gets a new key, so only that
// tile remounts and replays the flip, the way a split-flap board only turns the flaps
// whose letter changed.
export default function FlapText({
  value,
  tone,
  size = "md",
}: {
  value: string;
  tone?: "amber" | "red" | "green";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span className={styles.flap} data-tone={tone} data-size={size}>
      <span className="sr-only">{value}</span>
      <span className={styles.tiles} aria-hidden="true">
        {Array.from(value).map((char, index) => (
          <span
            className={styles.tile}
            data-blank={char === " " || undefined}
            key={`${index}:${char}`}
          >
            {char}
          </span>
        ))}
      </span>
    </span>
  );
}
