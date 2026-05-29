/**
 * Compose multiple resolver wrappers into a single wrapper.
 * Right-to-left: compose(A, B, C)(resolver) === A(B(C(resolver)))
 * Outermost wrapper (A) runs first; innermost (C) is closest to the actual resolver.
 */

type Wrapper<F> = (fn: F) => F;

export const compose =
  <F>(...wrappers: Wrapper<F>[]) =>
  (resolver: F): F =>
    wrappers.reduceRight((acc, wrapper) => wrapper(acc), resolver);
