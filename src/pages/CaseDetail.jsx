import { useParams } from 'react-router-dom'

function CaseDetail() {
  const { caseId } = useParams()

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">Case {caseId}</h1>
    </div>
  )
}

export default CaseDetail
