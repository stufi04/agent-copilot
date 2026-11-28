import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// The copilot's replies are Markdown (bold, lists, `code`, tables...). react-markdown
// builds React elements and never renders raw HTML, so model output can't inject markup.

const plugins = [remarkGfm];

const components: Components = {
  // Links open in a new tab, so following one doesn't leave the editor.
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="copilot-md">
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
