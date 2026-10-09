import AppShell from './components/layout/AppShell'
import TitleBar from './components/layout/TitleBar'
import ZoomToast from './components/layout/ZoomToast'
import QuickSearch from './components/layout/QuickSearch'

function App(): React.JSX.Element {
  return (
    <>
      <TitleBar />
      <AppShell />
      <ZoomToast />
      <QuickSearch />
    </>
  )
}

export default App
