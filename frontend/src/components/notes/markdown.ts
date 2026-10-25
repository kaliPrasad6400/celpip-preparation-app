import DOMPurify from "dompurify";
import { marked } from "marked";
import TurndownService from "turndown";

/** Markdown → HTML that TipTap understands (GFM task lists become TipTap task items). */
export function markdownToHtml(md: string): string {
  const raw = marked.parse(md, { gfm: true, async: false }) as string;
  const doc = new DOMParser().parseFromString(DOMPurify.sanitize(raw), "text/html");
  doc.querySelectorAll("ul").forEach((ul) => {
    const items = Array.from(ul.children).filter((c) => c.tagName === "LI");
    if (!items.length || !items.every((li) => li.querySelector(":scope > input[type=checkbox], :scope > p > input[type=checkbox]"))) return;
    ul.setAttribute("data-type", "taskList");
    items.forEach((li) => {
      const box = li.querySelector("input[type=checkbox]") as HTMLInputElement;
      const checked = box?.hasAttribute("checked");
      box?.remove();
      const text = li.innerHTML.trim();
      li.setAttribute("data-type", "taskItem");
      li.setAttribute("data-checked", checked ? "true" : "false");
      li.innerHTML = `<label><input type="checkbox"${checked ? " checked" : ""}></label><div>${text.startsWith("<p>") ? text : `<p>${text}</p>`}</div>`;
    });
  });
  return doc.body.innerHTML;
}

function turndown() {
  const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
  td.addRule("taskItem", {
    filter: (node) => node.nodeName === "LI" && (node as HTMLElement).getAttribute("data-type") === "taskItem",
    replacement: (content, node) => {
      const checked = (node as HTMLElement).getAttribute("data-checked") === "true";
      return `- [${checked ? "x" : " "}] ${content.trim().replace(/\n+/g, " ")}\n`;
    },
  });
  td.addRule("taskCheckboxLabel", {
    filter: (node) => node.nodeName === "LABEL" && !!(node as HTMLElement).closest("li[data-type=taskItem]"),
    replacement: () => "",
  });
  td.addRule("highlight", { filter: ["mark"], replacement: (c) => `==${c}==` });
  td.addRule("tableCell", {
    filter: ["th", "td"],
    replacement: (content, node) => ` ${content.trim().replace(/\n+/g, " ").replace(/\|/g, "\\|")} |${node.nextSibling ? "" : ""}`,
  });
  td.addRule("tableRow", {
    filter: "tr",
    replacement: (content, node) => {
      const tr = node as HTMLTableRowElement;
      let out = `|${content}\n`;
      const isHeader = tr.querySelector("th") && tr.parentElement && Array.from(tr.parentElement.children).indexOf(tr) === 0;
      if (isHeader) out += `|${Array.from(tr.children).map(() => " --- |").join("")}\n`;
      return out;
    },
  });
  td.addRule("table", { filter: "table", replacement: (content) => `\n\n${content}\n\n` });
  td.addRule("tableSection", { filter: ["thead", "tbody"], replacement: (content) => content });
  // internal app:// links keep their title as plain text plus a reference
  td.addRule("internalLink", {
    filter: (node) => node.nodeName === "A" && !!(node as HTMLElement).getAttribute("data-link-type"),
    replacement: (content, node) => `[${content}](${(node as HTMLElement).getAttribute("href")})`,
  });
  return td;
}

export function htmlToMarkdown(title: string, html: string): string {
  return `# ${title}\n\n${turndown().turndown(html || "")}\n`;
}

export function downloadText(filename: string, text: string, type = "text/markdown") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function titleFromMarkdown(md: string, fallback: string) {
  const m = md.match(/^#\s+(.+)$/m);
  return (m ? m[1] : fallback).trim().slice(0, 300);
}
