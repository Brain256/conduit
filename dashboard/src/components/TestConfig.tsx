import { useState } from 'react';

interface Props {
  onStart: (testId: string) => void;
}

export function TestConfig({ onStart }: Props) {
  const [port, setPort] = useState(8080);
  const [duration, setDuration] = useState(30);
  const [rps, setRps] = useState(1000);
  const [workers, setWorkers] = useState(10);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('http://localhost:8081/test/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        { 
          port: port,
          dur: duration,
          rps: rps, 
          workers: workers
        }
      ),
    });

    const data = await res.json();
    onStart(data.test_id);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-sm">
      <label>
        Port Number
        <input type="number" value={port} onChange={e => setPort(Number(e.target.value))} className="border p-1 w-full" />
      </label>
      <label>
        Duration (s)
        <input type="number" value={duration} onChange={e => setDuration(Number(e.target.value))} className="border p-1 w-full" />
      </label>
      <label>
        Target RPS
        <input type="number" value={rps} onChange={e => setRps(Number(e.target.value))} className="border p-1 w-full" />
      </label>
      <label>
        Number of Workers
        <input type="number" value={workers} onChange={e => setWorkers(Number(e.target.value))} className="border p-1 w-full" />
      </label>
      <button type="submit" className="bg-blue-600 text-white p-2 rounded">Start Test</button>
    </form>
  );
}