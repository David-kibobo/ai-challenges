// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import * as React from 'react'
import { Outlet, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  id: '__root',
  component: () => (
    <>
      <div>Hello "__root"!</div>
      <Outlet />
    </>
  ),
})
