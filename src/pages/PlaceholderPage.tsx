import React from "react";
import styles from "./PlaceholderPage.module.css";

interface PlaceholderPageProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
}

export function PlaceholderPage({ icon, title, description }: PlaceholderPageProps) {
  return (
    <div className={styles.page}>
      <div className={styles.placeholder}>
        {icon && <div className={styles.icon}>{icon}</div>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
    </div>
  );
}
