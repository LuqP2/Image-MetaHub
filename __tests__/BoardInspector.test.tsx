import React from 'react';
import {cleanup,render,screen,fireEvent,act} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import Inspector from '../components/boards/BoardInspector';
import {useBoardStore} from '../store/useBoardStore';
import {createBoardDocument} from '../services/boards/document.mjs';
import {addAssets,addText,addConnection} from '../services/boards/operations';
import {createBoardAssetReference} from '../services/boards/assetResolver';
import {boardImage,boardDirectory} from './helpers/boardIntegrationFixtures';
afterEach(cleanup);
it('shows metadata first and applies mixed fields to selected assets',()=>{
 const image=boardImage('folder/a.png');
 const board=addAssets(createBoardDocument(),[image,image].map(i=>({name:i.name,mediaType:'image' as const,reference:createBoardAssetReference(i,[boardDirectory])})),{x:0,y:0});
 const first=board.objects[0];if(first.type==='asset')first.visibleFields=['model'];
 useBoardStore.getState().adoptBoard(board);useBoardStore.getState().setSelection(board.id,board.objects.map(o=>o.id));
 render(<Inspector boardId={board.id} editable assetMetadata={<p>Prompt details</p>}/>);
 expect(screen.getByText('Prompt details')).toBeTruthy();
 expect(screen.queryByRole('checkbox',{name:'Model'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Show on canvas'}));
 const model=screen.getByRole('checkbox',{name:'Model'}) as HTMLInputElement;
 expect(model.indeterminate).toBe(true);fireEvent.click(model);
 expect(useBoardStore.getState().sessions[board.id].document.objects.every(o=>o.type==='asset' && o.visibleFields.includes('model'))).toBe(true);
 act(()=>useBoardStore.getState().setSelection(board.id,[board.objects[0].id]));
 expect(screen.getByRole('heading',{name:'a.png'})).toBeTruthy();
});

it('applies installed fonts and a removable text background with undo', async () => {
 const original = window.electronAPI;
 window.electronAPI = { boardsFonts: vi.fn().mockResolvedValue({ success: true, data: ['Arial', 'Segoe UI'] }) } as unknown as typeof window.electronAPI;
 try {
  const board = addText(createBoardDocument(), {x:0,y:0});
  useBoardStore.getState().adoptBoard(board);
  useBoardStore.getState().setSelection(board.id, [board.objects[0].id]);
  render(<Inspector boardId={board.id} editable/>);
  await screen.findByRole('option', {name:'Segoe UI'});
  fireEvent.change(screen.getByRole('combobox', {name:'Font'}), {target:{value:'Segoe UI'}});
  fireEvent.click(screen.getByRole('checkbox', {name:'Text background'}));
  fireEvent.change(screen.getByLabelText('Text background color'), {target:{value:'#123456'}});
  fireEvent.blur(screen.getByLabelText('Text background color'));
  expect(useBoardStore.getState().sessions[board.id].document.objects[0]).toMatchObject({fontFamily:'Segoe UI',backgroundColor:'#123456'});
  fireEvent.click(screen.getByRole('checkbox', {name:'Text background'}));
  expect(useBoardStore.getState().sessions[board.id].document.objects[0]).toMatchObject({backgroundColor:null});
  act(() => useBoardStore.getState().undo(board.id));
  expect(useBoardStore.getState().sessions[board.id].document.objects[0]).toMatchObject({backgroundColor:'#123456'});
 } finally { window.electronAPI = original; }
});
it('offers three thickness presets and solid/dashed connections, each as one undo action', () => {
 let board = addText(addText(createBoardDocument(), {x:0,y:0}), {x:400,y:0});
 board = addConnection(board, {sourceObjectId:board.objects[0].id,targetObjectId:board.objects[1].id,sourceSide:'right',targetSide:'left',color:'#112233',label:''});
 useBoardStore.getState().adoptBoard(board);
 useBoardStore.getState().setSelection(board.id, [], [board.connections[0].id]);
 render(<Inspector boardId={board.id} editable/>);
 expect(screen.getByRole('button', {name:'Thin'}).getAttribute('aria-pressed')).toBe('true');
 fireEvent.click(screen.getByRole('button', {name:'Thick'}));
 fireEvent.click(screen.getByRole('button', {name:'Dashed'}));
 expect(useBoardStore.getState().sessions[board.id].document.connections[0]).toMatchObject({width:5,lineStyle:'dashed'});
 act(() => useBoardStore.getState().undo(board.id));
 expect(useBoardStore.getState().sessions[board.id].document.connections[0].lineStyle).toBeUndefined();
 expect(useBoardStore.getState().sessions[board.id].document.connections[0].width).toBe(5);
});
