import type { UserSignupEvent } from '@netlify/functions'
import { roleMetadata } from '../lib/core.mts'

// Every new signup starts as a member. Staff and admin roles are granted from the admin dashboard.
export default {
  userSignup(event: UserSignupEvent) {
    return {
      user: {
        ...event.user,
        appMetadata: roleMetadata(event.user.appMetadata, 'member'),
      },
    }
  },
}
