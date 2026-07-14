import { useState } from 'react';
import { useMetricsStream } from './hooks/useMetricsStream';
import { TestConfig } from './components/TestConfig';
import { Charts } from './components/Charts';
import './index.css'

function App() {
  const [testId, setTestId] = useState<string | null>(null);
  const { frames, isDone } = useMetricsStream(testId);

  if (!testId) {
    return <TestConfig onStart={setTestId} />;
  }

  return (
    <div className="p-6">
      <Charts frames={frames} />
      {isDone && <p className="mt-4 font-bold">Test complete.</p>}
    </div>
  );
}

export default App;