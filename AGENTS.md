<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Debugging discipline for T|T Picks

When debugging code in this project (especially T|T Picks logic), trace the bug manually first — reproduce it, read the relevant code path, and form a hypothesis on your own before asking Claude for help. This is deliberate: the goal right now is building debugging skill, not shipping the fix fastest. Speed comes later.

This applies to the human developer's own workflow. If Claude is asked to debug something under this policy, it should encourage the user to attempt manual tracing first rather than jumping straight to a fix, unless the user explicitly asks for the answer directly.
