/**
 * Renders the editorial `about` copy stored on states, sublocations and cameras.
 *
 * Light markdown, deliberately hand-rolled: a line starting with `## ` is a
 * heading, runs of lines starting with `- ` become one bullet list, everything
 * else is a paragraph, and a blank line ends the current block. Soft-wrapped
 * lines inside a paragraph are joined with a space.
 *
 * Every value reaches the DOM as a React text node — never
 * dangerouslySetInnerHTML — so a pasted `<script>` renders as visible, inert
 * text. That is the whole XSS story here: there is no HTML path to sanitize.
 *
 * ponytail: no links, bold, italics, images, nested lists, ordered lists or code
 * spans — that is the ceiling of a 20-line splitter that is safe by
 * construction. If the copy ever needs real formatting, swap this for
 * react-markdown behind rehype-sanitize rather than growing the parser.
 */

type Block = { kind: 'h2' | 'ul' | 'p'; lines: Array<string> }

function parse(text: string): Array<Block> {
  const blocks: Array<Block> = []
  let open: Block | null = null

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) {
      open = null // blank line closes the current paragraph or list
      continue
    }
    // A heading always stands alone, even when the editor forgot the blank line.
    if (line.startsWith('## ')) {
      blocks.push({ kind: 'h2', lines: [line.slice(3).trim()] })
      open = null
      continue
    }
    const kind = line.startsWith('- ') ? 'ul' : 'p'
    const content = kind === 'ul' ? line.slice(2).trim() : line
    if (open && open.kind === kind) {
      open.lines.push(content)
    } else {
      open = { kind, lines: [content] }
      blocks.push(open)
    }
  }

  return blocks
}

export default function EditorialText({ text }: { text: string }) {
  return (
    <>
      {parse(text).map((block, i) => {
        if (block.kind === 'h2') {
          // A step below the section's own <h2> so the two do not compete.
          return (
            <h2 key={i} className="mt-8 !text-xl first:mt-0 sm:!text-2xl">
              {block.lines[0]}
            </h2>
          )
        }
        if (block.kind === 'ul') {
          return (
            <ul
              key={i}
              className="mb-6 list-disc space-y-2 pl-6 font-sans text-base leading-relaxed text-subtext1 md:text-lg"
            >
              {block.lines.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          )
        }
        return <p key={i}>{block.lines.join(' ')}</p>
      })}
    </>
  )
}

/**
 * AboutSection is the mounted form of the above: a titled prose block that
 * renders nothing at all when the copy is empty, so pages without editorial
 * content keep their current shape.
 */
export function AboutSection({ title, text }: { title: string; text: string }) {
  if (!text.trim()) return null
  return (
    <section className="section-container mb-14">
      <h2>{title}</h2>
      <div className="max-w-3xl [&>p:last-child]:mb-0 [&>ul:last-child]:mb-0">
        <EditorialText text={text} />
      </div>
    </section>
  )
}
