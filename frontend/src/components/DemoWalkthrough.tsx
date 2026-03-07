import './DemoWalkthrough.css';

export interface DemoWalkthroughProps {
  open: boolean;
  onClose: () => void;
}

export function DemoWalkthrough({ open, onClose }: DemoWalkthroughProps) {
  if (!open) return null;

  return (
    <div
      className="demo-walkthrough-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-walkthrough-title"
    >
      <div className="demo-walkthrough-panel" onClick={(e) => e.stopPropagation()}>
        <div className="demo-walkthrough-header">
          <h2 id="demo-walkthrough-title">Demo guide</h2>
          <button type="button" className="demo-walkthrough-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="demo-walkthrough-body">
          <ol className="demo-walkthrough-steps">
            <li>
              <strong>Atlas autocomplete</strong> — In the suburb field, type two or three letters and watch Atlas
              Search autocomplete suggest suburbs from your data.
            </li>
            <li>
              <strong>Filter search and pipelines</strong> — Choose bedrooms, bathrooms, and parking, then click
              Search. Check the pipeline panel to see the aggregation pipeline and how quickly results return
              using MongoDB compound indexes (sub‑millisecond retrieval).
            </li>
            <li>
              <strong>Agentic chat</strong>
              <ul>
                <li>
                  Ask: “Find me a quiet, nicely renovated apartment with natural light near James Ruse Public
                  School.” The agent will ask for the number of bedrooms.
                </li>
                <li>
                  Then ask: “What would be a price guide for a two bedroom apartment in Carlingford?” and see the
                  sales data and which tools the agent used.
                </li>
                <li>
                  Ask: “How safe is it to live in Carlingford?” The agent has no data or tools for that, so it
                  will respond that it can’t provide further information on that.
                </li>
                <li>
                  Finally ask: “What have I asked you so far?” You’ll get the list of questions from this
                  conversation, showing the agent’s in-chat memory and reduced hallucination.
                </li>
              </ul>
            </li>
            <li>
              <strong>Summary</strong> — This demo shows how a unified data platform (MongoDB) streamlines
              property search with fast retrieval, less sync tax, and accurate results using lexical
              prefilters.
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
