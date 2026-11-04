import React from 'react';

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode; // optional row under the subtitle (e.g. profile prompt)
}

/** The one page header used on every screen: large title, muted subtitle, actions on the right. */
const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, actions, children }) => (
  <header className="page-header fade-up">
    <div>
      <h1 className="page-title">{title}</h1>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
      {children}
    </div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>
);

export default PageHeader;
