import { useTranslation } from 'react-i18next'
import { AgentSettingsSection } from '../features/settings/AgentSettingsSection'

export function AgentSettingsWorkspace({ token }: { token: string }) {
  const { t } = useTranslation()
  return <section className="workspace">
    <div className="page-heading"><div><p className="kicker">{t('agentSettings.pageKicker')}</p><h1>{t('agentSettings.pageTitle')}</h1><p className="subheading">{t('agentSettings.pageCopy')}</p></div></div>
    <AgentSettingsSection token={token} />
  </section>
}

export default AgentSettingsWorkspace
