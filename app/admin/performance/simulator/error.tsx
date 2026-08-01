"use client";

export default function OperationalSimulatorError({ reset }: { reset: () => void }) {
  return <div className="card" style={{ padding: 24 }}><h2>Simulator could not load</h2><p className="section-intro">No operational data was changed.</p><button className="btn btn-primary" onClick={reset}>Try again</button></div>;
}
