import type { VinylColorInput } from '../../../web/src/vinylColorForm'

/** Jonathan's Chai Gray, Oct 21, 2026: per section, 6x8 only, ND and DS. */
export const CHAI_GRAY: VinylColorInput = {
  name: 'Chai Gray', mode: 'section', sizes: ['6x8'], methods: ['nd', 'ds'], samePostPrice: true,
  posts: { '6': { allCents: 3892 } }, capCents: 386, uprightCents: 1336,
  sections: { '6x8': { costCents: 18400, pickets: 15, rails: 2, railFt: 8, picketStiffeners: 3, railStiffeners: 1, uChannels: 2 } },
}
