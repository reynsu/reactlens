import { useEffect, useState } from 'react';

type Article = { id: string; title: string };

export function ArticleList(): JSX.Element {
  const [articles, setArticles] = useState<Article[]>([]);

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_BASE_URL}/articles`)
      .then((r) => r.json())
      .then(setArticles);
  }, []);

  return (
    <ul data-testid="article-list">
      {articles.map((a) => (
        <li key={a.id}>{a.title}</li>
      ))}
    </ul>
  );
}
