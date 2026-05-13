type Price = { amount: number; currency: string };
type Product = { id: string; name: string; price: Price };

export function ProductCard(props: { product: Product }): JSX.Element {
  const { name, price } = props.product;
  return (
    <article data-testid={`product-${props.product.id}`}>
      <h3>{name}</h3>
      <span data-testid="product-price">
        {price.amount} {price.currency}
      </span>
    </article>
  );
}
