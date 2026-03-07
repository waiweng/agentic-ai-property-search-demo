interface PipelinePaneProps {
  steps: string[];
  title?: string;
  aggregationPipeline?: object[];
  /** Tool call query for get_market_estimate (filter used on market_data collection). */
  marketEstimateQuery?: object;
}

export function PipelinePane({ steps, title = 'Search pipeline', aggregationPipeline, marketEstimateQuery }: PipelinePaneProps) {
  if (!steps?.length && !aggregationPipeline?.length && !marketEstimateQuery) return null;
  return (
    <div className="pipeline-pane">
      {title && <h4 className="pipeline-pane-title">{title}</h4>}
      {steps?.length > 0 && (
        <ol className="pipeline-pane-list">
          {steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
      {marketEstimateQuery && Object.keys(marketEstimateQuery).length > 0 && (
        <div className="pipeline-pane-code">
          <h5 className="pipeline-pane-code-title">Tool: get_market_estimate</h5>
          <p className="pipeline-pane-code-desc">Query used on <code>market_data</code> collection (findOne filter):</p>
          <pre className="pipeline-pane-pre">
            {JSON.stringify(marketEstimateQuery, null, 2)}
          </pre>
        </div>
      )}
      {aggregationPipeline && aggregationPipeline.length > 0 && (
        <div className="pipeline-pane-code">
          <h5 className="pipeline-pane-code-title">Aggregation pipeline</h5>
          <pre className="pipeline-pane-pre">
            {JSON.stringify(aggregationPipeline, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
