import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/posts/$id')({
  component: () => (
    <>
      <div>posts-id</div>
      
    </>
  ),
})