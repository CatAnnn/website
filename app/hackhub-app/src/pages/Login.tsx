import { Anchor, Box, Paper, Text, Title } from '@mantine/core'
import { Link } from 'react-router-dom'
import { useLanguage } from '../contexts/LanguageContext'
import { CompanyLogin } from '../components/CompanyLogin'
import boschLogo from '../assets/login/Bosch_symbol_logo_black_red.svg'
import cnAward from '../assets/login/CN_Award.svg'
import styles from './Login.module.css'

export function Login() {
  const { language } = useLanguage()
  const chinese = language === 'zh'

  return (
    <Box component="main" className={styles.page}>
      <Paper component="section" radius={0} className={styles.panel} aria-labelledby="employee-login-title">
        <Anchor component={Link} to="/" className={styles.brand} aria-label="Bosch CN Award home">
          <img src={boschLogo} alt="BOSCH" className={styles.boschLogo} />
          <span className={styles.divider} aria-hidden="true" />
          <img src={cnAward} alt="CN Award" className={styles.awardLogo} />
        </Anchor>

        <Title id="employee-login-title" order={1} className={styles.heading}>
          {chinese ? '员工登录' : 'Login For Employees'}
        </Title>

        <CompanyLogin chinese={chinese} />

        <Box className={styles.notice}>
          <Text className={styles.noticeText}>
            {chinese
              ? '请使用 Bosch 公司账号登录 CN Award，无需单独注册。'
              : 'Use your Bosch company account to sign in to CN Award. No separate registration is required.'}
          </Text>
        </Box>

        <Box component="footer" className={styles.footer}>
          <Text className={styles.help}>
            {chinese ? '登录遇到问题？' : 'Having trouble signing in?'}
            <br />
            {chinese ? '请联系网站管理员。' : 'Please contact the portal administrator.'}
          </Text>
          <Anchor
            href="https://www.bosch.com/corporate-information/"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.corporateLink}
          >
            {chinese ? '公司信息' : 'Corporate information'}
          </Anchor>
        </Box>
      </Paper>
    </Box>
  )
}
