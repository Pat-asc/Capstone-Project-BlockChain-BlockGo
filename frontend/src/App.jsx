import React from 'react';
import GradesDashboard from './components/GradesDashboard';

function App() {
  return (
    <div className="App">
      <header style={{ backgroundColor: '#2c3e50', padding: '15px', color: 'white', textAlign: 'center' }}>
        <h1>Pamantasan ng Lungsod ng Valenzuela (PLV) Blockchain System</h1>
      </header>
      <GradesDashboard />
    </div>
  );
}

export default App;