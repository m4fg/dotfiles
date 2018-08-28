if &compatible
 set nocompatible
endif
" Add the dein installation directory into runtimepath
set runtimepath+=~/.cache/dein/repos/github.com/Shougo/dein.vim

if dein#load_state('~/.cache/dein')
    call dein#begin('~/.cache/dein')

        call dein#add('~/.cache/dein')
        call dein#add('Shougo/deoplete.nvim')
        if !has('nvim')
            call dein#add('roxma/nvim-yarp')
            call dein#add('roxma/vim-hug-neovim-rpc')
        endif

        call dein#add('Shougo/unite.vim')
        call dein#add('Shougo/vimproc.vim', {'build' : 'make'})
        call dein#add('Shougo/neomru.vim')
        call dein#add('Shougo/neocomplete.vim')
        call dein#add('Shougo/neosnippet.vim')
        call dein#add('Shougo/neosnippet-snippets')
        
        call dein#add('itchyny/lightline.vim')
        call dein#add('nathanaelkane/vim-indent-guides')
        call dein#add('Townk/vim-autoclose')
        call dein#add('honza/vim-snippets')
        call dein#add('ujihisa/neco-look')

        call dein#add('scrooloose/nerdtree')
        call dein#add('leafgarland/typescript-vim')

    call dein#end()
    call dein#save_state()
endif

if dein#check_install()
    call dein#install()
endif

filetype plugin indent on
syntax enable

"""" config """"
let mapleader = "\<Space>"

set ruler
set number
set nowrap

set showtabline=2
set laststatus=2
let g:lightline = {
      \ 'separator': { 'left': "\ue0b0", 'right': "\ue0b2" },
      \ 'subseparator': { 'left': "\ue0b1", 'right': "\ue0b3" }
      \ }


"" nerdtree
"autocmd VimEnter * execute 'NERDTree'
autocmd bufenter * if (winnr("$") == 1 && exists("b:NERDTree") && b:NERDTree.isTabTree()) | q | endif

let NERDTreeQuitOnOpen = 1
autocmd bufenter * if (winnr("$") == 1 && exists("b:NERDTreeType") && b:NERDTreeType == "primary") | q | endif

nnoremap <Leader>f :NERDTreeToggle<Enter>
nnoremap <silent> <Leader>v :NERDTreeFind<CR>

"" unite
let g:unite_source_history_yank_enable = 1
try
  let g:unite_source_rec_async_command='ag --nocolor --nogroup -g ""'
  call unite#filters#matcher_default#use(['matcher_fuzzy'])
catch
endtry
" search a file in the filetree
nnoremap <space><space> :Unite -start-insert file_rec/async<cr>
" reset not it is <C-l> normally
:nnoremap <space>r <Plug>(unite_restart)
