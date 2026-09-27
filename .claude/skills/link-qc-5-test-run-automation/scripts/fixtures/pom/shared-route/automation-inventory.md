# Automation inventory — dashboard-kpi (fixture)

**Scanned:** the whole automation root (2 page classes in 2 files) · **Screens the TCs touch:** 2

| Screen | Decision | Class | Candidates considered | Reason |
|---|---|---|---|---|
| Dashboard | reuse DashboardPage | DashboardPage (pages/DashboardPage.ts) | DashboardWidgetPage — rejected | same route, but it drives only the KPI widget; the whole-screen locators live here |
| KPI widget | reuse DashboardWidgetPage | DashboardWidgetPage (pages/DashboardWidgetPage.ts) | DashboardPage — rejected | the widget refresh and tile locators are not on DashboardPage; sharing /dashboard is by design |
