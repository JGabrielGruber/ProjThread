import { Marked } from "marked";

const marked = new Marked({
  gfm: true,
  async: false,
  renderer: {
    html() {
      return "";
    },
    image() {
      return "";
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (href.startsWith("http:") || href.startsWith("https:")) {
        return `<a href="${href}">${label}</a>`;
      }
      return label;
    },
  },
});

export function renderMarkdown(src: string): string {
  return marked.parse(src) as string;
}
