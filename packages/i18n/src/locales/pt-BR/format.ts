/** Units and compact numbers. */
export const format = {
  money: (n: number) => `R$ ${n}`,
  moneyThousands: (n: string) => `R$ ${n} mil`,
  meters: (n: number) => `${n} m`,
  kilometers: (n: string) => `${n} km`,
  minutes: (n: number) => `${n} min`,
};
