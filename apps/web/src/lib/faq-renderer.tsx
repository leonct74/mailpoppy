import Link from "next/link";
import { FAQ_LINKS } from "./site";

/**
 * Renders a FAQ answer with clickable links substituted where configured.
 * Searches for link placeholders in the answer text and replaces them with Link components.
 */
export function FaqAnswer({ question, answer }: { question: string; answer: string }) {
  const links = FAQ_LINKS[question];

  if (!links || links.length === 0) {
    return <p className="text-muted mt-3 text-sm leading-relaxed">{answer}</p>;
  }

  // Build an array of text and link elements
  let remaining = answer;
  const elements: (string | React.ReactNode)[] = [];
  let nodeIndex = 0;

  for (const link of links) {
    const parts = remaining.split(link.find);
    if (parts.length < 2) continue; // Link placeholder not found in this segment

    // Add the text before the link
    if (parts[0]) {
      elements.push(parts[0]);
    }

    // Add the clickable link
    elements.push(
      <Link
        key={`link-${nodeIndex}`}
        href={link.href}
        className="text-primary font-semibold hover:underline"
      >
        {link.text}
      </Link>
    );
    nodeIndex++;

    // Continue with the rest of the text
    remaining = parts.slice(1).join(link.find);
  }

  // Add any remaining text
  if (remaining) {
    elements.push(remaining);
  }

  return (
    <p className="text-muted mt-3 text-sm leading-relaxed">
      {elements.map((el, i) => (typeof el === "string" ? el : el))}
    </p>
  );
}
