import React from 'react';
import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import Panel from '../components/ComparisonMetadataPanel';
import {boardImage} from './helpers/boardIntegrationFixtures';
afterEach(cleanup);
it('embeds metadata without the duplicate file header or nested scroll',()=>{
 const image=boardImage('folder/example.png');
 image.metadata={...image.metadata,normalizedMetadata:{prompt:'A detailed mountain scene',model:'Long model name'}} as typeof image.metadata;
 const view=render(<Panel image={image} isExpanded={false} onToggleExpanded={vi.fn()} presentation="embedded"/>);
 expect(screen.getByText('A detailed mountain scene')).toBeTruthy();
 expect(screen.queryByText('folder/example.png')).toBeNull();
 expect(view.container.querySelector('.overflow-y-auto')).toBeNull();
});
it('keeps the default panel header and expansion control',()=>{
 const image=boardImage('example.png'); const toggle=vi.fn();
 render(<Panel image={image} isExpanded={false} onToggleExpanded={toggle}/>);
 expect(screen.getByRole('button',{name:/example.png/})).toBeTruthy();
});
