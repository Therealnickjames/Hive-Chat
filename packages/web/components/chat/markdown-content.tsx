"use client";

import { useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

interface MarkdownContentProps {
  content: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 text-xs text-text-muted hover:text-text-primary bg-background-secondary px-2 py-1 rounded transition opacity-0 group-hover:opacity-100"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  if (!content) return null;

  return (
    <div className="markdown-content text-sm text-text-primary">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          p: ({ children }) => (
            <p className="mb-1 last:mb-0 whitespace-pre-wrap break-words">{children}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-text-primary">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-link hover:underline"
            >
              {children}
            </a>
          ),
          code: ({ className, children, ...props }) => {
            const isBlock =
              className?.includes("hljs") || className?.includes("language-");
            if (isBlock) {
              return (
                <code className={`${className || ""} font-mono text-sm`} {...props}>
                  {children}
                </code>
              );
            }

            return (
              <code className="bg-background-tertiary text-amber-300 px-1.5 py-0.5 rounded text-xs font-mono">
                {children}
              </code>
            );
          },
          pre: ({ children }) => {
            let codeText = "";
            const extractText = (node: unknown): string => {
              if (typeof node === "string") return node;
              if (Array.isArray(node)) return node.map(extractText).join("");
              if (node && typeof node === "object" && "props" in node) {
                const element = node as { props?: { children?: unknown } };
                return extractText(element.props?.children);
              }
              return "";
            };
            codeText = extractText(children);

            return (
              <div className="group relative my-2">
                <pre className="bg-background-tertiary rounded-lg p-4 overflow-x-auto">
                  {children}
                </pre>
                <CopyButton text={codeText.trim()} />
              </div>
            );
          },
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-brand pl-3 text-text-secondary italic my-2">
              {children}
            </blockquote>
          ),
          ul: ({ children }) => (
            <ul className="list-disc ml-6 my-1 space-y-0.5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal ml-6 my-1 space-y-0.5">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-sm text-text-primary">{children}</li>
          ),
          h1: ({ children }) => (
            <h1 className="text-lg font-bold text-text-primary mt-3 mb-1">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-semibold text-text-primary mt-3 mb-1">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold text-text-primary mt-2 mb-1">
              {children}
            </h3>
          ),
          hr: () => <hr className="border-background-primary my-3" />,
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-background-primary px-3 py-1 text-left font-semibold bg-background-tertiary">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-background-primary px-3 py-1">{children}</td>
          ),
          img: ({ alt }) => (
            <span className="text-text-muted italic">
              [Image: {alt || "no description"}]
            </span>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
