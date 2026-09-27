import AppShell from './components/layout/AppShell'
import TitleBar from './components/layout/TitleBar'
import ZoomToast from './components/layout/ZoomToast'

function App(): React.JSX.Element {
  return (
    <>
      <TitleBar />
      <AppShell />
      <ZoomToast />
    </>
  )
}

export default App
