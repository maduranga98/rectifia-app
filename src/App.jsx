import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Submit from './pages/Submit'
import CaseDetail from './pages/CaseDetail'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/submit" element={<Submit />} />
      <Route path="/case/:caseId" element={<CaseDetail />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/admin" element={<Admin />} />
    </Routes>
  )
}

export default App
