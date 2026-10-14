// An OMP extension the Pair panel loads into the OMP it starts (`omp -e`): before each request,
// it cuts the pair `step` calls the programmer interrupted back to what played. See history.ts.

import { playedOnly } from "./history"

type ContextEvent = { messages: unknown[] }
type Omp = { on(event: "context", handler: (event: ContextEvent) => ContextEvent | undefined): void }

export default function (pi: Omp): void {
  pi.on("context", (event) => {
    const messages = playedOnly(event.messages)
    return messages === event.messages ? undefined : { messages }
  })
}
