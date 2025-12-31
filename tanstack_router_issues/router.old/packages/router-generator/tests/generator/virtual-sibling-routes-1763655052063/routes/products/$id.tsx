import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/products/$id')({
  component: () => (
    <>
      <div>product-id</div>
      
    </>
  ),
})